import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { fingerprint } from "../lib/crypto";

export function KeyFingerprint({ publicKey }: { publicKey: string }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fingerprint(publicKey).then((result) => !cancelled && setValue(result));
    return () => {
      cancelled = true;
    };
  }, [publicKey]);
  return (
    <span className="fingerprint mono">
      <Fingerprint aria-hidden="true" /> {value}
    </span>
  );
}
