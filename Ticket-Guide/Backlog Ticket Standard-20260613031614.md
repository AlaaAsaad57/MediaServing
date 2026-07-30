# Backlog Ticket Standard

#   

> **Purpose:** هذا المستند هو المرجع الرسمي لكتابة التذاكر (User Stories / Work Items) في TryDos. يجب أن يلتزم به كل عضو في الفريق. أي تذكرة لا تتبع هذا المعيار تُعاد لصاحبها ليعيد كتابتها.
#   

يجب تعبئة **كل** هذه الحقول في أعلى التذكرة (في ClickUp Custom Fields):

| Property | Type | Required | Description |
| ---| ---| ---| --- |
| Title | Text | ✔️ | عنوان قصير بصيغة: Verb + Object (مثل: Create User) |
| ID | Auto | ✔️ | يُولّد تلقائيًا |
| Status | Status | ✔️ | Workflow الرسمي |
| Backbone | Select | ✔️ | الموديول (Admin Dashboard, RDP…) |
| Actor | Multi-select | ✔️ | System Admin, Account Admin, Normal User, System |
| Assignee | Person | ✔️ | الشخص المسؤول |
| Time Estimate (h) | Number | ✔️ | التقدير بالساعات |
| Sprint | Relation | ⬜ | Sprint المرتبطة |
| User Story Relation | Relation | ⬜ | الربط مع الـ Epic |
| Estimation per User Story | Relation | ⬜ | تقديرات إضافية (اختياري) |

**:**
### **Status**
`Backlog` → `Planned` → `TODO` → `In progress` → `Ready For Developer Review` → `Ready For EM Review` → `EM Testing (DEV ENV)` → `Ready For Release` → `In Release (STAGING)` → `Released To PROD`
#   

> **يجب أن يحتوي جسم التذكرة على 3 أقسام فقط وبنفس الترتيب.**
انسخ هذا القالب كما هو داخل Description:
markdown

```yaml
## User StoryAs **a [Actor / role within a tenant]**,
I want to be able to **[action / capability]**,
so that **[business value / benefit]**.

[One short paragraph: scope, key constraints, what is in/out of scope,
references to related stories by ID.]

---

# Acceptance Criteria---

## Scope & Tenant Safety1. [Atomic, testable statement.]
2. [Atomic, testable statement.]

## Authorization1. [Who may perform the action.]
2. Unauthorized attempts return 403 (API) / hide the control (UI).

## General Behavior1. [What the feature does in general.]

## Form Fields### Required Fields1. **Field A**2. **Field B**Rules:
1. All required fields are validated before saving.

### Optional Fields1. Field C
2. Field D

## Behavior After Saving1. [What happens after successful save.]

## Validation & Constraints1. [Patterns, formats, mandatory-field enforcement.]

## UI & API Consistency1. UI and API enforce identical rules.
2. Errors are returned in a structured format.

## Audit & Logging1. [What is logged on success.]
2. [What is logged on failure.]

---

# Test Cases---

## Happy Path — [Descriptive scenario name]**Given** [precondition]  
**And** [extra precondition]  
**When** [action]  
**Then**- [Expected, observable result]  
- [Expected, observable result]

---

## Validation Error — [Descriptive scenario name]**Given** [precondition]  
**When** [invalid action / invalid input]  
**Then**- [Validation error is shown]  
- [No data is saved]

---

## Authorization Failure — [Descriptive scenario name]**Given** [unauthorized user / role]  
**When** [they attempt the action]  
**Then**- [UI hides the control]  
- [API returns 403 Forbidden]
```

#   

> **تُضاف داخل كل تذكرة Backlog** Task → Add Checklist → Paste
كتابة تعليمات برمجية

```less
Ticket Quality Checklist

- [ ] Title is short and action-oriented (verb + object)
- [ ] Status, Backbone, Actor, Assignee, Time Estimate are filled
- [ ] Body contains all 3 sections: User Story, Acceptance Criteria, Test Cases
- [ ] User Story uses As / I want / so that format with a real benefit
- [ ] Summary paragraph includes scope, constraints, in/out of scope
- [ ] Acceptance Criteria are grouped into named sub-sections
- [ ] Every criterion is atomic and testable (yes/no)
- [ ] Tenant safety is explicitly addressed
- [ ] Authorization rules are clearly defined
- [ ] Validation rules are clearly defined
- [ ] Behavior After Saving is defined
- [ ] UI & API consistency is defined
- [ ] Audit & Logging rules are included
- [ ] Test Cases cover: Happy Path, Validation Error, Authorization Failure
- [ ] No ambiguous words (“maybe”, “etc.”, “should probably”)
- [ ] Related tickets referenced by ID (if applicable)
```

#   

> **يوضع في ClickUp Docs أو Notion — ليس داخل التذكرة**
كتابة تعليمات برمجية

```markdown
# Common Mistakes to Avoid When Writing Tickets

## 1. Bad Titles
- ❌ Using vague nouns like “Tickets”, “Users”, “Orders”
- ✔ Use action-oriented titles: “Create User”, “Edit Order”, “Delete Ticket”

## 2. Incorrect User Story Format
- ❌ Missing “so that…”
- ❌ Repeating the action instead of stating the benefit
- ✔ Must follow: As a…, I want…, so that…

## 3. Acceptance Criteria Problems
- ❌ Writing AC as one long paragraph
- ❌ No numbered lists
- ❌ No sub-sections
- ❌ Missing validation rules
- ❌ Missing authorization rules
- ✔ AC must be atomic, testable, grouped into sections

## 4. Missing Error/Validation Behavior
- ❌ Only describing the happy path
- ✔ Must include validation errors and authorization failures

## 5. Missing Test Cases
- ❌ No test cases at all
- ❌ Test cases not in Given/When/Then format
- ✔ Must include: Happy Path, Validation Error, Authorization Failure

## 6. Missing Required Metadata
- ❌ No Assignee
- ❌ No Time Estimate
- ❌ No Actor
- ❌ No Backbone
- ✔ All metadata must be filled before the ticket is accepted

## 7. Ambiguous Wording
- ❌ Using “maybe”, “etc.”, “should probably”
- ✔ Replace with explicit, testable statements

## 8. No Reference to Related Tickets
- ❌ Not linking to parent Epic or related stories
- ✔ Always reference related tickets by ID
```

#