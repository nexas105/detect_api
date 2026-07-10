declare module '@mantine/core/styles.css';
declare module '@mantine/notifications/styles.css';
declare module '*.css';

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
