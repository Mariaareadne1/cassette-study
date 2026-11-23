import dynamic from 'next/dynamic';
import Head from 'next/head';

const Experience = dynamic(() => import('@/ui/Experience'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Cassette Study — Object Study 001</title>
        <meta name="description" content="A transparent late-1990s cassette player you can open, load, play and record your own tape into." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <Experience />
    </>
  );
}
