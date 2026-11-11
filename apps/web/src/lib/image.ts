import { api } from './api';

const MAX_DIMENSION = 1600;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.82),
  );
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/u, '.webp'), {
    type: 'image/webp',
    lastModified: file.lastModified,
  });
}

export async function uploadFile(file: File): Promise<{
  id: string;
  key: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}> {
  const prepared = await compressImage(file);
  const data = new FormData();
  data.set('file', prepared);
  const response = await api<{
    data: { id: string; key: string; name: string; mime: string; size: number; url: string };
  }>('/uploads', { method: 'POST', body: data });
  return response.data;
}
