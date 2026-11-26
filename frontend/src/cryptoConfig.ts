import type { CryptoConfig } from "./api";
import type { KdfParams } from "./crypto";

export const DEFAULT_CRYPTO_CONFIG: CryptoConfig = {
  argon2_time_cost: 3,
  argon2_memory_kib: 65536,
  argon2_parallelism: 1,
  argon2_hash_len: 32,
  credential_rotation_days: 180,
};

export function toKdfParams(cfg: CryptoConfig): KdfParams {
  return {
    timeCost: cfg.argon2_time_cost,
    memoryKib: cfg.argon2_memory_kib,
    parallelism: cfg.argon2_parallelism,
    hashLen: cfg.argon2_hash_len,
  };
}
