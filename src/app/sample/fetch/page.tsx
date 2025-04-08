'use client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Suspense } from 'react';

type RepositoryProps = {
  id: number;
  name: string;
  full_name: string;
  description: string;
  stargazers_count: number;
} & Record<string, unknown>;

const fetchRepositories = async (): Promise<RepositoryProps[]> => {
  // const url = 'https://mocki.io/v1/ad841940-cc6f-4ed2-83ff-cab434183a58';
  const url = 'https://api.github.com/orgs/facebook/repos';
  const response = await fetch(url);
  return await response.json();
};

const myQuery = (): RepositoryProps[] => {
  const { data } = useSuspenseQuery({
    queryKey: ['repo', 'facebook'],
    queryFn: async () => await fetchRepositories()
  });
  return data;
  // return [query.data, query] as const;
};

const Repos = (): JSX.Element => {
  const data = myQuery();
  return (
    <>
      {data.map((repo, index) => {
        return (
          <p key={index}>
            {repo.name} / {repo.description}
          </p>
        );
      })}
    </>
  );
};

export default function Page(): JSX.Element {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Repos />
    </Suspense>
  );
}
