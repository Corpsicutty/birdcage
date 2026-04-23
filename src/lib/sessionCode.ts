const ALPHA_NUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateSessionCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * ALPHA_NUM.length);
    code += ALPHA_NUM[index];
  }
  return code;
}
