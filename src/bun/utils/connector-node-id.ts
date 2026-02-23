export function buildNamespaceNodeId(namespaceName: string): string {
  return `ns:${encodeURIComponent(namespaceName)}`;
}

export function parseNamespaceNodeId(nodeId: string): string | null {
  if (!nodeId.startsWith("ns:")) {
    return null;
  }

  try {
    return decodeURIComponent(nodeId.slice(3));
  } catch {
    return null;
  }
}

export function buildEntityNodeId(
  namespaceName: string,
  entityType: string,
  entityName: string,
): string {
  return `entity:${encodeURIComponent(namespaceName)}:${encodeURIComponent(entityType)}:${encodeURIComponent(entityName)}`;
}

export function parseEntityNodeId(nodeId: string): {
  namespaceName: string;
  entityType: string;
  entityName: string;
} | null {
  if (!nodeId.startsWith("entity:")) {
    return null;
  }

  const body = nodeId.slice("entity:".length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    return null;
  }

  try {
    return {
      namespaceName: decodeURIComponent(parts[0]),
      entityType: decodeURIComponent(parts[1]),
      entityName: decodeURIComponent(parts[2]),
    };
  } catch {
    return null;
  }
}
