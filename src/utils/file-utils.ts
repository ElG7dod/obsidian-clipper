import browser from './browser-polyfill';
import { detectBrowser } from './browser-detection';

export interface SaveFileOptions {
	content: string;
	fileName: string;
	path?: string;
	mimeType?: string;
	tabId?: number;
	onError?: (error: Error) => void;
}

export function base64EncodeUnicode(str: string): string {
	const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
		(match, p1) => String.fromCharCode(parseInt(p1, 16))
	);
	return btoa(utf8Bytes);
}

function sanitizeDownloadSegment(segment: string): string {
	return segment
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/[\x00-\x1F\x7F]/g, '')
		.replace(/^[. ]+|[. ]+$/g, '');
}

export async function saveFile({
	content,
	fileName,
	path = '',
	mimeType = 'text/markdown',
	tabId,
	onError
}: SaveFileOptions): Promise<void> {
	try {
		let cleanFileName = sanitizeDownloadSegment(fileName) || 'untitled';
		if (mimeType === 'text/markdown' && !cleanFileName.toLowerCase().endsWith('.md')) {
			cleanFileName = `${cleanFileName}.md`;
		}

		const cleanFolder = path
			.split(/[\\/]/)
			.map(sanitizeDownloadSegment)
			.filter(seg => seg.length > 0 && seg !== '.' && seg !== '..')
			.join('/');

		const downloadPath = cleanFolder ? `${cleanFolder}/${cleanFileName}` : cleanFileName;

		const browserType = await detectBrowser();
		const isSafari = ['ios', 'mobile-ios', 'ipad-os', 'safari', 'mobile-safari'].includes(browserType);
		
		if (isSafari) {
			const blob = new Blob([content], { type: 'application/json' });
			const file = new File([blob], cleanFileName, { type: 'application/json' });
			const dataUri = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

			// Use share API if there is no tab ID, e.g. in settings pages
			if (!tabId) {				
				if (navigator.share) {
					try {
						await navigator.share({
							files: [file],
							text: cleanFileName
						});
					} catch (error) {
						console.error('Error sharing:', error);
						// Fallback to opening in a new tab if sharing fails
						window.open(dataUri);
					}
				} else {
					// Fallback for older iOS versions
					window.open(dataUri);
				}
				throw new Error('Tab ID is required for saving files in Safari');
			}

			await browser.scripting.executeScript({
				target: { tabId },
				func: (fileName: string, dataUri: string) => {
					const a = document.createElement('a');
					a.href = dataUri;
					a.download = fileName;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
				},
				args: [cleanFileName, dataUri]
			});
		} else if (browser.downloads?.download) {
			const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
			const url = URL.createObjectURL(blob);

			await browser.downloads.download({
				url,
				filename: downloadPath,
				saveAs: false,
				conflictAction: 'uniquify'
			});

			// Give Firefox time to finish reading the Blob before revoking
			setTimeout(() => URL.revokeObjectURL(url), 10000);
		} else {
			const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = cleanFileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	} catch (error) {
		console.error('Failed to save file:', error);
		if (onError) {
			onError(error as Error);
		}
	}
}