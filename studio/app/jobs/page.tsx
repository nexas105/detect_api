'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconDownload,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ApiKeySelect } from '@/components/ApiKeySelect';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';

const POLL_MS = 2500;
const TERMINAL = ['succeeded', 'failed'];

// Status → verdict palette (Design Spec: allow/flag/block only for signal).
function statusColor(status: string): string {
  if (status === 'succeeded') return 'allow';
  if (status === 'failed') return 'block';
  if (status === 'running') return 'cyan';
  return 'flag'; // queued
}

interface JobStatus {
  job_id: string;
  endpoint: string;
  status: string;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
  status_url: string;
  output_url: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export default function JobsPage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();

  const [jobIdInput, setJobIdInput] = useState('');
  const [activeId, setActiveId] = useState('');
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Prefill from ?id= / ?job_id= without pulling in useSearchParams' Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('id') || q.get('job_id');
    if (id) { setJobIdInput(id); setActiveId(id); }
  }, []);

  const fetchStatus = useCallback(async (id: string) => {
    if (!id || !selectedKey.trim()) return;
    setError('');
    try {
      const res = await fetch(`${API_URL}/jobs/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setJob(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job status');
      setJob(null);
    }
  }, [selectedKey]);

  // Poll while a job is active and not in a terminal state.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!activeId || !selectedKey.trim()) return;
    let cancelled = false;
    setLoading(true);
    fetchStatus(activeId).finally(() => { if (!cancelled) setLoading(false); });
    timer.current = setInterval(() => {
      setJob((cur) => {
        if (cur && TERMINAL.includes(cur.status)) {
          if (timer.current) { clearInterval(timer.current); timer.current = null; }
          return cur;
        }
        fetchStatus(activeId);
        return cur;
      });
    }, POLL_MS);
    return () => { cancelled = true; if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [activeId, selectedKey, fetchStatus]);

  const handleTrack = () => {
    setJob(null);
    setActiveId(jobIdInput.trim());
  };

  const handleDownload = useCallback(async () => {
    if (!job?.output_url || !selectedKey.trim()) return;
    setDownloading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/jobs/${encodeURIComponent(job.job_id)}/output`, {
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = job.job_id;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  }, [job, selectedKey]);

  const isTerminal = job ? TERMINAL.includes(job.status) : false;

  return (
    <DashboardShell>
      <PageHeader title="Async Jobs" subtitle="Track the status of an asynchronous job and download its output when it finishes." />

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

          <TextInput
            label="Job ID"
            placeholder="Paste a job_id"
            value={jobIdInput}
            onChange={(e) => setJobIdInput(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTrack(); }}
          />

          <Text size="xs" c="dimmed">
            A job_id is returned when you submit a batch or video request in async mode
            (e.g. POST /batch?async=true or /video/classify?async=true), which responds with 202 and a job_id.
          </Text>

          <Button
            leftSection={<IconSearch size={16} />}
            onClick={handleTrack}
            loading={loading}
            disabled={!jobIdInput.trim() || !selectedKey.trim()}
            fullWidth
          >
            Track job
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

      {job && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">Job status</Text>
            <Group gap="xs">
              <Badge variant="light" size="lg" color={statusColor(job.status)} className="data-mono">
                {job.status}
              </Badge>
              {!isTerminal && (
                <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => fetchStatus(job.job_id)}>
                  Refresh
                </Button>
              )}
            </Group>
          </Group>

          <Progress value={job.progress} color={statusColor(job.status)} mb="md" />

          <Table>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td><Text size="sm" c="dimmed">Job ID</Text></Table.Td>
                <Table.Td><Text size="sm" className="data-mono">{job.job_id}</Text></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text size="sm" c="dimmed">Endpoint</Text></Table.Td>
                <Table.Td><Text size="sm" className="data-mono">{job.endpoint}</Text></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text size="sm" c="dimmed">Progress</Text></Table.Td>
                <Table.Td><Text size="sm" className="data-mono">{job.progress}%</Text></Table.Td>
              </Table.Tr>
              {job.created_at && (
                <Table.Tr>
                  <Table.Td><Text size="sm" c="dimmed">Created</Text></Table.Td>
                  <Table.Td><Text size="sm" className="data-mono">{job.created_at}</Text></Table.Td>
                </Table.Tr>
              )}
              {job.started_at && (
                <Table.Tr>
                  <Table.Td><Text size="sm" c="dimmed">Started</Text></Table.Td>
                  <Table.Td><Text size="sm" className="data-mono">{job.started_at}</Text></Table.Td>
                </Table.Tr>
              )}
              {job.completed_at && (
                <Table.Tr>
                  <Table.Td><Text size="sm" c="dimmed">Completed</Text></Table.Td>
                  <Table.Td><Text size="sm" className="data-mono">{job.completed_at}</Text></Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>

          {job.error && (
            <Alert icon={<IconAlertCircle size={16} />} color="block" mt="md" title="Job failed">
              <Text className="data-mono" size="sm">{job.error}</Text>
            </Alert>
          )}

          {job.result && (
            <Stack gap={4} mt="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Result</Text>
              <Paper withBorder p="sm" radius="sm" style={{ overflowX: 'auto' }}>
                <Text component="pre" size="xs" className="data-mono" style={{ margin: 0 }}>
                  {JSON.stringify(job.result, null, 2)}
                </Text>
              </Paper>
            </Stack>
          )}

          {job.output_url && (
            <Button
              mt="md"
              leftSection={<IconDownload size={16} />}
              onClick={handleDownload}
              loading={downloading}
              disabled={job.status !== 'succeeded'}
            >
              Download output
            </Button>
          )}
        </Paper>
      )}
    </DashboardShell>
  );
}
