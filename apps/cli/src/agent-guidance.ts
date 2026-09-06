export const deliveryQaGuidance = `### Delivery QA

- The owner is not the default QA. For fixes or behavior changes, reproduce when feasible, apply or deploy safely, then repeat the same user-visible scenario on the actual consumed target; project rules define the exact check.
- Builds, tests, mocks, and source inspection are supporting evidence, not proof of a user-visible fix.
- Report exactly one status: \`VERIFIED FIXED\`, \`IMPLEMENTED NOT VERIFIED\`, \`BLOCKED\`, or \`NOT FIXED\`; only the first means the original scenario passed on target.
- Run one verification plus at most two evidence-driven repair/retest cycles. Do not blindly repeat; then stop with the truthful non-success status.
`;
