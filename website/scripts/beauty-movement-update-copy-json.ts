function extractJsonValue(output: string): unknown {
    for (let start = 0; start < output.length; start += 1) {
        const opening = output[start];
        if (opening !== "[" && opening !== "{") continue;
        const stack: string[] = [];
        let inString = false;
        let escaped = false;
        for (let index = start; index < output.length; index += 1) {
            const character = output[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (character === "\\") {
                    escaped = true;
                } else if (character === '"') {
                    inString = false;
                }
                continue;
            }
            if (character === '"') {
                inString = true;
                continue;
            }
            if (character === "[" || character === "{") {
                stack.push(character);
                continue;
            }
            if (character !== "]" && character !== "}") continue;
            const expected = character === "]" ? "[" : "{";
            if (stack.at(-1) !== expected) break;
            stack.pop();
            if (stack.length !== 0) continue;
            try {
                return JSON.parse(output.slice(start, index + 1));
            } catch {
                break;
            }
        }
    }
    throw new Error("beauty_movement_campaign_copy_update_response_invalid");
}

export function parseD1UpdateResponse(stdout: string): unknown {
    const output = stdout
        .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/^\uFEFF/, "")
        .trim();
    try {
        return JSON.parse(output);
    } catch {
        // Wrangler/npm can prefix the JSON payload with a banner or warning.
    }
    return extractJsonValue(output);
}
