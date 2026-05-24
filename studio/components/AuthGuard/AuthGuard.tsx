'use client';

import { Center, Loader } from '@mantine/core';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const publicPaths = ['/login', '/register', '/demo'];
  const isPublic = publicPaths.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  useEffect(() => {
    if (!loading && !user && !isPublic) {
      router.replace('/login');
    }
  }, [user, loading, pathname, router, isPublic]);

  if (loading && !isPublic) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  if (!user && !isPublic) {
    return null;
  }

  return <>{children}</>;
}
