export type TwoFactorData = {
  ok?: boolean;
  enabled?: boolean;
  verified?: boolean;
  locked?: boolean;
  uri?: string;
  secret?: string;
  recoveryCodes?: string[];
  error?: string;
};

export type TwoFactorDependencies = {
  navigate?: (path: string) => void;
  fetcher?: typeof fetch;
};

export type TwoFactorPageProps = {
  dependencies?: TwoFactorDependencies;
};
