declare module "argon2-browser/dist/argon2-bundled.min.js" {
  type ArgonHashInput = {
    pass: string;
    salt: Uint8Array;
    type: number;
    hashLen: number;
    time: number;
    mem: number;
    parallelism: number;
  };

  type ArgonHashOutput = {
    hash: Uint8Array;
  };

  export const hash: (input: ArgonHashInput) => Promise<ArgonHashOutput>;
  export const ArgonType: { Argon2id?: number };
}
