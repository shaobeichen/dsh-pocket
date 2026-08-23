// Small shared helpers for the optional LAN IP override.

/** @param {unknown} value
 *  @returns {boolean} */
export function isValidIpv4(value) {
  const m = String(value ?? '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m !== null && m.slice(1).every((part) => {
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}
