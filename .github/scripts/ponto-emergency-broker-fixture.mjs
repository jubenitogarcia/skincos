import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const createEmergencyBrokerFixture = ({
  target,
  custodyRef,
  url = "https://close.example.invalid/v1/ponto",
} = {}) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = `${target}-broker-response-key-v1`;
  return {
    privateKey,
    policy: {
      url,
      custodyRef,
      responseKeyId: keyId,
      responsePublicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    },
    signResponse(payload, requestUrl, init, { issuedAt } = {}) {
      const requestBinding = {
        schemaVersion: 1,
        contractId: init.headers["x-skincos-emergency-contract"],
        method: init.method,
        url: requestUrl,
        target: init.headers["x-skincos-emergency-target"],
        custodyRef: init.headers["x-skincos-emergency-custody-ref"],
        responseKeyId: init.headers["x-skincos-emergency-response-key-id"],
        requestNonce: init.headers["x-skincos-emergency-request-nonce"],
        requestedAt: init.headers["x-skincos-emergency-requested-at"],
        requestDigest: init.headers["x-skincos-emergency-request-digest"],
      };
      const unsignedAttestation = {
        schemaVersion: 1,
        contractId: requestBinding.contractId,
        keyId,
        issuedAt: issuedAt || requestBinding.requestedAt,
        requestBinding,
        responseDigest: sha256(canonicalJson(payload)),
      };
      return {
        ...payload,
        brokerAttestation: {
          ...unsignedAttestation,
          signature: sign(
            null,
            Buffer.from(canonicalJson(unsignedAttestation)),
            privateKey,
          ).toString("base64url"),
        },
      };
    },
  };
};
