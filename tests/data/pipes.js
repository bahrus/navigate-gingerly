// A module an app's JSON names, for resolveModules
export const plainText = html => String(html).replace(/<[^>]*>/g, '');
export default function shout(value) { return String(value).toUpperCase(); }
