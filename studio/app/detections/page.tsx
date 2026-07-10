'use client';

import React, { useState } from 'react';
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
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { API_URL } from '@/lib/auth';
import { useAuthQuery } from '@/lib/use-auth-query';
import { colorForLabel } from '@/lib/detection-draw';
import type { Detection as DetectionItem } from '@/lib/api-types';

/** A stored detection record (mirrors the /detections list row). */
interface DetectionRecord {
  id: string;
  image_id?: string;
  endpoint?: string;
  model?: string;
  detections?: DetectionItem[];
  original_path?: string;
  censored_path?: string;
  created_at?: string;
}

/** Detection label with its bounding-box color as a dot (shared color map). */
function LabelDot({ label }: { label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={7} h={7} style={{ borderRadius: 2, background: colorForLabel(label), flexShrink: 0 }} />
      <Text className="data-mono" size="sm">
        {label}
      </Text>
    </Group>
  );
}

function shortId(d: DetectionRecord): string {
  if (d.image_id) return d.image_id.length > 20 ? `${d.image_id.slice(0, 20)}...` : d.image_id;
  return d.id.slice(0, 12);
}

export default function DetectionsPage() {
  const t = useTranslations('detections');
  const tCommon = useTranslations('common');
  const { data, error, isLoading } = useAuthQuery<{ detections: DetectionRecord[] }>('/detections?limit=50');
  const detections = data?.detections ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => setExpandedId(expandedId === id ? null : id);

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {error && (
        <Text c="block.6" mb="md">
          {error}
        </Text>
      )}

      {isLoading ? (
        <SkeletonList count={5} />
      ) : detections.length === 0 ? (
        <EmptyState icon={IconPhotoOff} message={t('noDetections')} />
      ) : (
        <>
          <Box visibleFrom="sm">
            <Table highlightOnHover>
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
                    <Table.Tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(d.id)}>
                      <Table.Td w={30}>
                        {expandedId === d.id ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm">
                          {shortId(d)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {d.endpoint && (
                          <Badge className="data-mono" color={d.endpoint === 'censor' ? 'flag' : 'cyan'} variant="light" size="sm">
                            {d.endpoint}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm" c={d.model ? undefined : 'dimmed'}>
                          {d.model || '--'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge className="data-mono" variant="light" color="cyan" size="sm">
                          {d.detections?.length ?? 0}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm" c="dimmed">
                          {d.created_at ? new Date(d.created_at).toLocaleString() : '--'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                    {expandedId === d.id && (
                      <Table.Tr key={`${d.id}-detail`}>
                        <Table.Td colSpan={6}>
                          <Collapse expanded={expandedId === d.id}>
                            <Paper withBorder p="md" mt="xs" mb="xs">
                              {/* Detection details */}
                              {d.detections && d.detections.length > 0 ? (
                                <>
                                  <Text className="data-mono" fz={11} fw={600} tt="uppercase" lts={1.5} c="dimmed" mb="sm">
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
                                            <LabelDot label={det.label} />
                                          </Table.Td>
                                          <Table.Td>
                                            <Text className="data-mono" size="sm">
                                              {(det.score * 100).toFixed(1)}%
                                            </Text>
                                          </Table.Td>
                                          <Table.Td>
                                            <Text className="data-mono" size="xs" c="dimmed">
                                              {det.box ? det.box.map((v) => v.toFixed(0)).join(', ') : '--'}
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
                                  <Text className="data-mono" fz={11} fw={600} tt="uppercase" lts={1.5} c="dimmed" mb="sm">
                                    {t('image')}
                                  </Text>
                                  <Group>
                                    {d.original_path && (
                                      <a href={`${API_URL}/storage/${d.original_path}`} target="_blank" rel="noopener noreferrer">
                                        <Paper withBorder p="xs">
                                          <Text className="data-mono" fz={10} c="dimmed" tt="uppercase" lts={1} mb={4}>
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
                                      <a href={`${API_URL}/storage/${d.censored_path}`} target="_blank" rel="noopener noreferrer">
                                        <Paper withBorder p="xs">
                                          <Text className="data-mono" fz={10} c="dimmed" tt="uppercase" lts={1} mb={4}>
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
              <Paper key={d.id} p="md" withBorder>
                <Group justify="space-between" mb="xs" wrap="nowrap">
                  <Text className="data-mono" size="sm" truncate>
                    {shortId(d)}
                  </Text>
                  <Badge className="data-mono" variant="light" color="cyan" size="sm">
                    {d.detections?.length ?? 0}
                  </Badge>
                </Group>
                <Group gap="xs" mb="xs">
                  {d.endpoint && (
                    <Badge className="data-mono" color={d.endpoint === 'censor' ? 'flag' : 'cyan'} variant="light" size="sm">
                      {d.endpoint}
                    </Badge>
                  )}
                  {d.model && (
                    <Text className="data-mono" size="xs" c="dimmed">
                      {d.model}
                    </Text>
                  )}
                </Group>
                <Text className="data-mono" size="xs" c="dimmed">
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
