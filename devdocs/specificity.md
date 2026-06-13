# Determining precedence in Lamp via specificity

When Lamp determines which rule to apply, it uses a system of specificity to decide which rule takes precedence. The more specific a when clause is, the higher its precedence.

The specificity of a when clause is initially defined as 0.

- Each atomic boolean condition (comparison, literal, etc.) is assigned a value of 1 point.
- The value of two anded conditions is the sum of their individual points.
- The value of two ored conditions is the maximum of their individual points.
- A negated condition (`not`) has the same specificity as its inner condition — specificity is unchanged by negation.

For example, the when clause `when x > 5 and y < 10` has a specificity of 2, while the when clause `when x > 5 or y < 10` has a specificity of 1. The clause `when not (x > 5)` has a specificity of 1.

Nested compound expressions follow the same rules. For example, `when (x > 5 and y < 10) or z == 1` has specificity max(2, 1) = 2.

When Lamp evaluates which rule to apply, it compares the specificity of the when clauses. The rule with the highest specificity is chosen. If there is a tie in specificity, Lamp will choose the last rule defined in the code.

## Constraints on conditional function definitions

- All overloads of a function must share the same signature: same parameter count, same parameter names (in order), same parameter types, and same return type. It is a compile error if they differ.
- At most one overload may be unconditional (no `when` clause). Multiple unconditional definitions of the same function are a compile error.
- `when` conditions may only reference global variables and object properties. Function calls and function references are not permitted in `when` conditions. Parameters are also not accessible in `when` conditions (the condition is evaluated against game state, not argument values).
- If two `when` clauses on the same function have syntactically identical conditions, Lamp will emit a warning.
- If a function has conditional overloads but no unconditional fallback, and at runtime no condition matches, Lamp throws a runtime error: `no matching version of <name> for current game state`.
