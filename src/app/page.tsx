import { Button } from '@mantine/core';
import Link from 'next/link';

export default function Page(): JSX.Element {
  return (
    <main>
      <Button component={Link} href='/sample/fetch'>
        fetch
      </Button>
    </main>
  );
}
