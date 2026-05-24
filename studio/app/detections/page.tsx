'use client';

import React from 'react';
import {
  Badge,
  Box,
  Collapse,
  Group,
  Image,
  Paper,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPhotoOff } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { API_URL, AUTH_URL, useAuth } from '@/lib/auth';

interface Detection {
  id: string;
  image_id?: string;
  endpoint?: string;
  model?: string;
  detections?: Array<{
    label: string;
    score: number;
    box?: number[];
  }>;
  original_path?: string;
  censored_path?: string;
  created_at?: string;
}

export default function DetectionsPage() {
  const { authFetch } = useAuth();
  const t = useTranslations('detections');
  const tCommon = useTranslations('common');
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchDetections = useCallback(async () => {
    try {
      const res = await authFetch(`${AUTH_URL}/detections?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setDetections(data.detections || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || tCommon('error'));
      }
    } catch {
      setError(tCommon('error'));
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchDetections();
  }, [fetchDetections]);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {error && (
        <Text c="red" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <SkeletonList count={5} />
      ) : detections.length === 0 ? (
        <EmptyState icon={IconPhotoOff} message={t('noDetections')} />
      ) : (
        <>
        <Box visibleFrom="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>{t('image')}</Table.Th>
              <Table.Th>{t('endpoint')}</Table.Th>
              <Table.Th>{t('model')}</Table.Th>
              <Table.Th>{t('detections')}</Table.Th>
              <Table.Th>{t('timestamp')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {detections.map((d) => (
              <React.Fragment key={d.id}>
                <Table.Tr
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleExpand(d.id)}
                >
                  <Table.Td w={30}>
                    {expandedId === d.id ? (
                      <IconChevronDown size={16} />
                    ) : (
                      <IconChevronRight size={16} />
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {d.image_id
                        ? d.image_id.length > 20
                          ? `${d.image_id.slice(0, 20)}...`
                          : d.image_id
                        : d.id.slice(0, 12)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {d.endpoint && (
                      <Badge
                        color={d.endpoint === 'censor' ? 'orange' : 'blue'}
                        variant="light"
                        size="sm"
                      >
                        {d.endpoint}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{d.model || '--'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm">
                      {d.detections?.length ?? 0}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {d.created_at
                        ? new Date(d.created_at).toLocaleString()
                        : '--'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
                {expandedId === d.id && (
                  <Table.Tr key={`${d.id}-detail`}>
                    <Table.Td colSpan={6}>
                      <Collapse expanded={expandedId === d.id}>
                        <Paper withBorder p="md" radius="md" mt="xs" mb="xs">
                          {/* Detection details */}
                          {d.detections && d.detections.length > 0 ? (
                            <>
                              <Text fw={600} mb="sm">
                                {tCommon('details')}
                              </Text>
                              <Table mb="md">
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>{tCommon('name')}</Table.Th>
                                    <Table.Th>Score</Table.Th>
                                    <Table.Th>Box</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {d.detections.map((det, idx) => (
                                    <Table.Tr key={idx}>
                                      <Table.Td>
                                        <Badge variant="light" size="sm">
                                          {det.label}
                                        </Badge>
                                      </Table.Td>
                                      <Table.Td>
                                        <Text size="sm">
                                          {(det.score * 100).toFixed(1)}%
                                        </Text>
                                      </Table.Td>
                                      <Table.Td>
                                        <Text size="xs" c="dimmed" ff="monospace">
                                          {det.box
                                            ? det.box
                                                .map((v) => v.toFixed(0))
                                                .join(', ')
                                            : '--'}
                                        </Text>
                                      </Table.Td>
                                    </Table.Tr>
                                  ))}
                                </Table.Tbody>
                              </Table>
                            </>
                          ) : (
                            <Text size="sm" c="dimmed" mb="md">
                              {t('noDetections')}
                            </Text>
                          )}

                          {/* Image links */}
                          {(d.original_path || d.censored_path) && (
                            <>
                              <Text fw={600} mb="sm">
                                {t('image')}
                              </Text>
                              <Group>
                                {d.original_path && (
                                  <a
                                    href={`${API_URL}/storage/${d.original_path}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Paper withBorder p="xs" radius="md">
                                      <Text size="xs" c="dimmed" mb={4}>
                                        Original
                                      </Text>
                                      <Image
                                        src={`${API_URL}/storage/${d.original_path}`}
                                        alt="Original"
                                        w={200}
                                        h={150}
                                        fit="contain"
                                        radius="sm"
                                        fallbackSrc="https://placehold.co/200x150?text=No+Preview"
                                      />
                                    </Paper>
                                  </a>
                                )}
                                {d.censored_path && (
                                  <a
                                    href={`${API_URL}/storage/${d.censored_path}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Paper withBorder p="xs" radius="md">
                                      <Text size="xs" c="dimmed" mb={4}>
                                        Censored
                                      </Text>
                                      <Image
                                        src={`${API_URL}/storage/${d.censored_path}`}
                                        alt="Censored"
                                        w={200}
                                        h={150}
                                        fit="contain"
                                        radius="sm"
                                        fallbackSrc="https://placehold.co/200x150?text=No+Preview"
                                      />
                                    </Paper>
                                  </a>
                                )}
                              </Group>
                            </>
                          )}
                        </Paper>
                      </Collapse>
                    </Table.Td>
                  </Table.Tr>
                )}
              </React.Fragment>
            ))}
          </Table.Tbody>
        </Table>
        </Box>
        <Stack hiddenFrom="sm" gap="xs">
          {detections.map((d) => (
            <Paper key={d.id} p="md" withBorder radius="md">
              <Group justify="space-between" mb="xs" wrap="nowrap">
                <Text size="sm" ff="monospace" truncate>
                  {d.image_id ? (d.image_id.length > 20 ? `${d.image_id.slice(0, 20)}...` : d.image_id) : d.id.slice(0, 12)}
                </Text>
                <Badge variant="light" size="sm">
                  {d.detections?.length ?? 0}
                </Badge>
              </Group>
              <Group gap="xs" mb="xs">
                {d.endpoint && (
                  <Badge color={d.endpoint === 'censor' ? 'orange' : 'blue'} variant="light" size="sm">
                    {d.endpoint}
                  </Badge>
                )}
                {d.model && (
                  <Text size="xs" c="dimmed">{d.model}</Text>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {d.created_at ? new Date(d.created_at).toLocaleString() : '--'}
              </Text>
            </Paper>
          ))}
        </Stack>
        </>
      )}
    </DashboardShell>
  );
}
