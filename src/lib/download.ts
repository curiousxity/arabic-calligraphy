/** Triggers a browser download for `href`, optionally revoking it afterward (for blob/object URLs). */
export function triggerDownload(href: string, filename: string, revoke = false) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (revoke) URL.revokeObjectURL(href);
}
