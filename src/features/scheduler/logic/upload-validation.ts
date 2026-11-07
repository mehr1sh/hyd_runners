import type { TimetableUpload } from "@/lib/contracts";

/**
 * Upload checks shared by the browser (early feedback) and the server (the
 * real check). The server never trusts the file name or the browser's MIME
 * type: it sniffs the first bytes of the stored object.
 */

export type TimetableMimeType = TimetableUpload["mimeType"];

/** Matches `payload_too_large` in docs/CONTRACTS.md and the Storage bucket limit. */
export const MAX_TIMETABLE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES: readonly TimetableMimeType[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const EXTENSION_FOR: Record<TimetableMimeType, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type UploadRejection = {
  code: "empty_file" | "file_too_large" | "unsupported_type" | "content_mismatch";
  message: string;
};

export function isAcceptedMimeType(value: string): value is TimetableMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

/** Checks what the browser can know before uploading: declared type and size. */
export function checkDeclaredFile(file: { type: string; size: number }): UploadRejection | null {
  if (file.size === 0) return { code: "empty_file", message: "This file is empty. Choose another file." };
  if (file.size > MAX_TIMETABLE_BYTES) {
    return {
      code: "file_too_large",
      message: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB; try a smaller export or a photo of one page.`,
    };
  }
  if (!isAcceptedMimeType(file.type)) {
    return {
      code: "unsupported_type",
      message: "Upload a PDF, PNG, JPG or WebP file. Other formats, such as Word or Excel, are not supported.",
    };
  }
  return null;
}

/** Identify the real file type from its leading bytes, or null when it is none of the accepted types. */
export function sniffMimeType(bytes: Uint8Array): TimetableMimeType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

/** Server-side check of the stored bytes against the type the upload was registered with. */
export function checkStoredBytes(bytes: Uint8Array, declared: TimetableMimeType): UploadRejection | null {
  if (bytes.byteLength === 0) return { code: "empty_file", message: "The uploaded file is empty." };
  if (bytes.byteLength > MAX_TIMETABLE_BYTES) {
    return { code: "file_too_large", message: "The uploaded file is larger than 10 MB." };
  }
  const actual = sniffMimeType(bytes);
  if (!actual) {
    return {
      code: "unsupported_type",
      message: "This file is not a readable PDF, PNG, JPG or WebP. It may be damaged or in another format.",
    };
  }
  if (actual !== declared) {
    return {
      code: "content_mismatch",
      message: "The file's contents do not match its type. Re-export it as a PDF or image and try again.",
    };
  }
  return null;
}
