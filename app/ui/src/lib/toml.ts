export function tomlString(value: unknown): string {
    // TOML basic strings use the same escaping for quotes, backslashes and
    // control characters as JSON strings. JSON.stringify also keeps paths
    // containing apostrophes valid (for example /cloud/O'Brien).
    return JSON.stringify(String(value ?? ''));
}

export function tomlPath(value: unknown): string {
    return tomlString(String(value ?? '').replace(/\\/g, '/'));
}
