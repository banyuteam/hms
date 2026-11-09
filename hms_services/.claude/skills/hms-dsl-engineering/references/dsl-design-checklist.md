# DSL Design Checklist

- Is syntax declarative and constrained?
- Can the definition compile deterministically?
- Are types and source fields validated?
- Are operations allowlisted?
- Are required capabilities declared?
- Are tenant and permission scopes explicit?
- Can it be tested without production data?
- Is IR versioned and immutable after approval?
- Can Go validate it independently?
- Are execution time, memory and output bounded?
- Can the definition be rolled back?
- Is execution provenance auditable?
