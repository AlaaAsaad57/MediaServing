# Ticket Writing Guidelines

\# Common Mistakes to Avoid When Writing Tickets

\## 1. Bad Titles
\- ❌ Using vague nouns like “Tickets”, “Users”, “Orders”
\- ✔ Use action-oriented titles: “Create User”, “Edit Order”, “Delete Ticket”

\## 2. Incorrect User Story Format
\- ❌ Missing “so that…”
\- ❌ Repeating the action instead of stating the benefit
\- ✔ Must follow: As a…, I want…, so that…

\## 3. Acceptance Criteria Problems
\- ❌ Writing AC as one long paragraph
\- ❌ No numbered lists
\- ❌ No sub-sections
\- ❌ Missing validation rules
\- ❌ Missing authorization rules
\- ✔ AC must be atomic, testable, grouped into sections

\## 4. Missing Error/Validation Behavior
\- ❌ Only describing the happy path
\- ✔ Must include validation errors and authorization failures

\## 5. Missing Test Cases
\- ❌ No test cases at all
\- ❌ Test cases not in Given/When/Then format
\- ✔ Must include: Happy Path, Validation Error, Authorization Failure

\## 6. Missing Required Metadata
\- ❌ No Assignee
\- ❌ No Time Estimate
\- ❌ No Actor
\- ❌ No Backbone
\- ✔ All metadata must be filled before the ticket is accepted

\## 7. Ambiguous Wording
\- ❌ Using “maybe”, “etc.”, “should probably”
\- ✔ Replace with explicit, testable statements

\## 8. No Reference to Related Tickets
\- ❌ Not linking to parent Epic or related stories
\- ✔ Always reference related tickets by ID