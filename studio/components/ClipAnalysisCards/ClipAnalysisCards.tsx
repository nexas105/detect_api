'use client';

import {
  Badge,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconShieldCheck,
  IconShirt,
  IconUser,
} from '@tabler/icons-react';

export interface AgeAnalysis {
  estimated_age: number;
  bracket: string;
  confidence?: number;
  is_minor_risk: boolean;
  available: boolean;
}

export interface DeepfakeAnalysis {
  fake_probability: number;
  is_likely_fake?: boolean;
  verdict: string;
  available: boolean;
}

export interface ClothingAnalysis {
  clothing: string;
  exposure_level: number;
  scores?: Record<string, number>;
  available: boolean;
}

function verdictColor(verdict: string): string {
  if (verdict === 'likely_real') return 'green';
  if (verdict === 'possibly_fake') return 'yellow';
  return 'red';
}

function bracketLabel(bracket: string): string {
  return bracket
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function verdictLabel(verdict: string): string {
  return verdict
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function clothingLabel(clothing: string): string {
  return clothing
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface ClipAnalysisCardsProps {
  age?: AgeAnalysis;
  deepfake?: DeepfakeAnalysis;
  clothing?: ClothingAnalysis;
}

export function ClipAnalysisCards({ age, deepfake, clothing }: ClipAnalysisCardsProps) {
  const showAge = age?.available;
  const showDeepfake = deepfake?.available;
  const showClothing = clothing?.available;

  if (!showAge && !showDeepfake && !showClothing) return null;

  const cards: React.ReactNode[] = [];

  if (showAge && age) {
    const isMinor = age.is_minor_risk;
    cards.push(
      <Paper
        key="age"
        withBorder
        p="md"
        radius="md"
        bg={isMinor ? 'var(--mantine-color-red-light)' : undefined}
      >
        <Group gap="xs" mb="xs">
          {isMinor ? (
            <IconAlertTriangle size={20} color="var(--mantine-color-red-6)" />
          ) : (
            <IconUser size={20} color="var(--mantine-color-blue-5)" />
          )}
          <Text size="sm" fw={600}>
            Age
          </Text>
        </Group>
        <Text fw={700} fz="lg">
          ~{Math.round(age.estimated_age)} years
        </Text>
        <Badge
          variant="light"
          color={isMinor ? 'red' : 'green'}
          size="sm"
          mt={4}
        >
          {isMinor ? 'Minor Risk' : bracketLabel(age.bracket)}
        </Badge>
      </Paper>
    );
  }

  if (showDeepfake && deepfake) {
    const color = verdictColor(deepfake.verdict);
    cards.push(
      <Paper key="deepfake" withBorder p="md" radius="md">
        <Group gap="xs" mb="xs">
          <IconShieldCheck size={20} color={`var(--mantine-color-${color}-5)`} />
          <Text size="sm" fw={600}>
            Deepfake
          </Text>
        </Group>
        <Badge variant="light" color={color} size="lg" mb={4}>
          {verdictLabel(deepfake.verdict)}
        </Badge>
        <Text size="xs" c="dimmed">
          Fake probability: {(deepfake.fake_probability * 100).toFixed(1)}%
        </Text>
      </Paper>
    );
  }

  if (showClothing && clothing) {
    cards.push(
      <Paper key="clothing" withBorder p="md" radius="md">
        <Group gap="xs" mb="xs">
          <IconShirt size={20} color="var(--mantine-color-grape-5)" />
          <Text size="sm" fw={600}>
            Clothing
          </Text>
        </Group>
        <Badge variant="light" color="grape" size="lg" mb="xs">
          {clothingLabel(clothing.clothing)}
        </Badge>
        <Stack gap={2}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Exposure
            </Text>
            <Text size="xs" fw={500}>
              {Math.round(clothing.exposure_level * 100)}%
            </Text>
          </Group>
          <Progress
            value={clothing.exposure_level * 100}
            color="grape"
            size="sm"
            radius="xl"
          />
        </Stack>
      </Paper>
    );
  }

  // Determine columns based on how many cards are visible
  const cols = cards.length >= 3 ? 3 : cards.length;

  return (
    <SimpleGrid cols={cols} mt="md">
      {cards}
    </SimpleGrid>
  );
}
