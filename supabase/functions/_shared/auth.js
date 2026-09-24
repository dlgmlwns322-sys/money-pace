// Edge Function 공용: 비밀키 비교
// 비밀키 비교: 둘 다 SHA-256으로 바꿔 같은 길이로 비교(길이·내용에 따라 걸리는 시간이 달라지지 않게)
export async function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(given))),
    crypto.subtle.digest("SHA-256", enc.encode(String(expected))),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
