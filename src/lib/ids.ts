const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ULID: 10 chars de tiempo + 16 de aleatoriedad (80 bits).
export function newId(): string {
  let time = Date.now();
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ALPHABET.charAt(time % 32) + ts;
    time = Math.floor(time / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let suffix = "";
  for (const b of rand) suffix += ALPHABET.charAt(b % 32);
  return ts + suffix;
}
