// A small JSON Schema checker for runbook output. It covers the keywords our contracts use, so a
// model's reply is held to its declared shape before any rule or reviewer looks at it.

export type Schema = {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean"
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean
  items?: Schema
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  enum?: readonly unknown[]
  nullable?: boolean
}

export function schemaErrors(value: unknown, schema: Schema, path = "$", errors: string[] = []): string[] {
  if (errors.length >= 20) return errors
  if (value === null && schema.nullable) return errors
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.map(String).join(", ")}`)
  switch (schema.type) {
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${path} must be an object`); return errors }
      const record = value as Record<string, unknown>
      for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${path}.${key} is missing`)
      for (const [key, child] of Object.entries(record)) {
        const rule = schema.properties?.[key]
        if (rule) schemaErrors(child, rule, `${path}.${key}`, errors)
        else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`)
      }
      return errors
    }
    case "array": {
      if (!Array.isArray(value)) { errors.push(`${path} must be a list`); return errors }
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} entries`)
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} entries`)
      if (schema.items) value.forEach((item, index) => schemaErrors(item, schema.items!, `${path}[${index}]`, errors))
      return errors
    }
    case "string":
      if (typeof value !== "string") { errors.push(`${path} must be text`); return errors }
      if (schema.minLength !== undefined && value.trim().length < schema.minLength) errors.push(`${path} is too short`)
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`)
      return errors
    case "integer":
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) { errors.push(`${path} must be ${schema.type === "integer" ? "a whole number" : "a number"}`); return errors }
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`)
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`)
      return errors
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path} must be true or false`)
      return errors
    default:
      return errors
  }
}
