const encoder = new TextEncoder();
const decoder = new TextDecoder();

const base64Encode = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const base64Decode = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const deriveKey = async (password: string, salt: Uint8Array, iterations: number) => {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export type EncryptedPayload = {
  cipher: string;
  salt: string;
  iv: string;
  iterations: number;
};

export const encryptHtml = async (html: string, password: string, iterations = 200000): Promise<EncryptedPayload> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = encoder.encode(html);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    cipher: base64Encode(encrypted),
    salt: base64Encode(salt.buffer),
    iv: base64Encode(iv.buffer),
    iterations,
  };
};

export const decryptHtml = async (
  payload: EncryptedPayload,
  password: string
): Promise<string> => {
  const salt = new Uint8Array(base64Decode(payload.salt));
  const iv = new Uint8Array(base64Decode(payload.iv));
  const key = await deriveKey(password, salt, payload.iterations);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    base64Decode(payload.cipher)
  );
  return decoder.decode(decrypted);
};
