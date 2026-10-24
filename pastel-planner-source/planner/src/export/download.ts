/**
 * Offers a generated file to the user.
 * Inside Claude (published artifact) downloads go through the `downloads`
 * capability, which asks the viewer to confirm. Elsewhere we fall back to a
 * normal browser download link.
 */
export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

export async function saveFile(filename: string, data: Blob): Promise<SaveOutcome> {
  const claude = (window as any).claude;
  if (claude?.use) {
    const downloads = await claude.use('downloads').catch(() => null);
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return 'saved';
      } catch (e: any) {
        if (e?.code === 'declined') return 'declined';
        if (e?.code === 'rate_limited') throw new Error('Another download prompt is already open. Finish it, then try again.');
        throw new Error(e?.message ?? 'The download could not be started.');
      }
    }
    return 'unavailable';
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

export const stamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
