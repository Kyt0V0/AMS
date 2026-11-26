declare global {
  type ArgonHashInput = {
    pass: string;
    salt: Uint8Array;
    type: number;
    hashLen: number;
    time: number;
    mem: number;
    parallelism: number;
  };

  type ArgonHashOutput = { hash: Uint8Array };

  interface Window {
    argon2?: {
      hash: (input: ArgonHashInput) => Promise<ArgonHashOutput>;
      ArgonType?: { Argon2id?: number };
    };
  }
}
export {};
