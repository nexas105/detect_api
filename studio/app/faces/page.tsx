'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconFaceId,
  IconFileUpload,
} from '@tabler/icons-react';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { DetectionFrame } from '@/components/DetectionFrame';
import { ApiKeySelect } from '@/components/ApiKeySelect';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';
import { loadImage, boxLineWidth } from '@/lib/detection-draw';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';
// ponytail: cyan accent hardcoded — canvas can't read the --mantine-color-cyan-5 CSS var.
const FACE_COLOR = '#38BDF8';

interface FaceItem {
  box: number[]; // [x, y, width, height]
  box_format?: string;
  score: number;
}

interface FacesResult {
  image_id: string;
  faces: FaceItem[];
  count: number;
}

export default function FacesPage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();

  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FacesResult | null>(null);

  const handleDetect = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/faces`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err.message || 'Face detection failed');
    } finally {
      setLoading(false);
    }
  }, [file, selectedKey]);

  // Draw the source image plus numbered face boxes onto a single canvas.
  // Drawing everything on one canvas avoids overlay coordinate-scaling bugs.
  useEffect(() => {
    if (!result || !file) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    loadImage(file).then((img) => {
      if (cancelled) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const lw = boxLineWidth(img.naturalWidth, img.naturalHeight);
      ctx.lineWidth = lw;
      ctx.strokeStyle = FACE_COLOR;
      ctx.fillStyle = FACE_COLOR;
      const fontSize = Math.max(14, lw * 7);
      ctx.font = `${fontSize}px monospace`;
      ctx.textBaseline = 'top';
      result.faces.forEach((face, idx) => {
        const [x, y, w, h] = face.box;
        ctx.strokeRect(x, y, w, h);
        const label = String(idx + 1);
        const padY = fontSize + lw * 2;
        ctx.fillStyle = FACE_COLOR;
        ctx.fillRect(x, Math.max(0, y - padY), fontSize * 0.8 * label.length + lw * 2, padY);
        ctx.fillStyle = '#0E1116';
        ctx.fillText(label, x + lw, Math.max(0, y - padY) + lw);
        ctx.fillStyle = FACE_COLOR;
      });
    });
    return () => { cancelled = true; };
  }, [result, file]);

  return (
    <DashboardShell>
      <PageHeader title="Face Detection" subtitle="Locate faces in an image and read their bounding boxes and confidence scores." />

      <Paper withBorder p="lg" radius="md" mb="xl">
        <Stack>
          <ApiKeySelect
            keys={keys}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            selectedKeyId={selectedKeyId}
            selectKey={selectKey}
            label="API Key"
            placeholder="Select a key"
          />

          <div>
            <Text size="sm" fw={500} mb={4}>File</Text>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(''); }}
              style={{ display: 'none' }}
            />
            <Group>
              <Button variant="light" leftSection={<IconFileUpload size={16} />} onClick={() => fileRef.current?.click()}>
                {file ? 'Change file' : 'Choose file'}
              </Button>
              {file && <Text size="sm" c="dimmed">{file.name} ({(file.size / 1024).toFixed(1)} KB)</Text>}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>Supported: JPG, PNG, WebP</Text>
          </div>

          <Button
            leftSection={<IconFaceId size={16} />}
            onClick={handleDetect}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
          >
            Detect faces
          </Button>
        </Stack>
      </Paper>

      {keysError && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" mb="xl" title="API Keys">
          {keysError}
        </Alert>
      )}

      {error && (
        <Paper withBorder p="lg" radius="md" mb="xl" style={{ borderColor: 'var(--mantine-color-red-6)' }}>
          <Text c="red">{error}</Text>
        </Paper>
      )}

      {result && (
        <DetectionFrame color="var(--mantine-color-cyan-5)" size={16} inset={-4} weight={2}>
          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">Detected faces</Text>
              <Badge variant="light" size="lg" className="data-mono">
                {result.count} {result.count === 1 ? 'face' : 'faces'}
              </Badge>
            </Group>

            <div style={{ overflowX: 'auto', marginBottom: 'var(--mantine-spacing-md)' }}>
              <canvas
                ref={canvasRef}
                style={{ maxWidth: '100%', height: 'auto', border: '1px solid var(--hairline)', borderRadius: 6, display: 'block' }}
              />
            </div>

            {result.faces.length > 0 ? (
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>Score</Table.Th>
                    <Table.Th>Box (x, y, w, h)</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.faces.map((face, idx) => (
                    <Table.Tr key={idx}>
                      <Table.Td><Text size="sm" className="data-mono">{idx + 1}</Text></Table.Td>
                      <Table.Td><Text size="sm" className="data-mono">{(face.score * 100).toFixed(1)}%</Text></Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" className="data-mono">
                          {face.box.map((v) => v.toFixed(0)).join(', ')}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : (
              <Text c="dimmed">No faces detected.</Text>
            )}
          </Paper>
        </DetectionFrame>
      )}
    </DashboardShell>
  );
}
