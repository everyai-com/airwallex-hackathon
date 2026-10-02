import type { AirwallexClient } from '../core/client.js';

export interface UploadedFile {
  fileId: string;
  filename?: string;
}

/** POST files.sandbox.airwallex.com/api/v1/files/upload — multipart, max 20MB. */
export async function uploadEvidence(
  client: AirwallexClient,
  input: { filename: string; contentType: string; content: Buffer; notes?: string },
): Promise<UploadedFile> {
  const form = new FormData();
  const bytes = new Uint8Array(input.content);
  form.append('file', new Blob([bytes], { type: input.contentType }), input.filename);
  if (input.notes) form.append('notes', input.notes.slice(0, 50));

  const response = await client.request<{ file_id?: string; filename?: string }>(
    '/api/v1/files/upload',
    { formData: form, filesHost: true },
  );
  const fileId = String(response.file_id ?? '');
  if (!fileId) {
    throw new Error('files/upload returned no file_id; refusing to submit evidence without it.');
  }
  return {
    fileId,
    ...(response.filename ? { filename: response.filename } : {}),
  };
}
