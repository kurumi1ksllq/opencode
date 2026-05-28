interface TaskSuggestion {
  title: string
  description: string
  acceptance: string[]
}

const categories: Array<{
  keywords: string[]
  title: string
  description: string
  acceptance: string[]
  order: number
}> = [
  {
    keywords: ["setup", "install", "init", "config"],
    title: "Setup Environment",
    description:
      "Set up the development environment, install dependencies, and configure project settings.",
    acceptance: [
      "Development environment is fully configured",
      "All dependencies are installed",
      "Project configuration files are properly set up",
    ],
    order: 1,
  },
  {
    keywords: ["deploy", "ci", "cd", "pipeline"],
    title: "Setup Deployment/CI",
    description:
      "Configure continuous integration, deployment pipeline, and automated build processes.",
    acceptance: [
      "CI pipeline is configured and passing",
      "Deployment process is automated",
      "Build artifacts are properly generated",
    ],
    order: 2,
  },
  {
    keywords: ["implement", "add", "feature", "create", "build"],
    title: "Implement Feature",
    description:
      "Implement the required feature according to specifications and requirements.",
    acceptance: [
      "Feature implementation is complete",
      "Feature works as specified in requirements",
      "Edge cases are handled properly",
    ],
    order: 3,
  },
  {
    keywords: ["test", "unit test", "integration test"],
    title: "Write Tests",
    description:
      "Write automated tests to ensure code quality and prevent regressions.",
    acceptance: [
      "Unit tests cover the core logic",
      "Integration tests cover critical paths",
      "All tests pass successfully",
    ],
    order: 4,
  },
  {
    keywords: ["doc", "readme", "document"],
    title: "Update Documentation",
    description:
      "Update documentation to reflect changes and provide clear usage instructions.",
    acceptance: [
      "README is updated with relevant information",
      "API documentation is complete and accurate",
      "Code comments are updated where necessary",
    ],
    order: 5,
  },
  {
    keywords: ["fix", "bug", "issue", "error"],
    title: "Fix Bug",
    description:
      "Identify and fix the reported bug or issue in the codebase.",
    acceptance: [
      "The bug is no longer reproducible",
      "The fix does not introduce new issues",
      "Root cause is identified and addressed",
    ],
    order: 6,
  },
  {
    keywords: ["refactor", "clean", "improve", "optimize"],
    title: "Refactor Code",
    description:
      "Refactor existing code to improve maintainability, readability, and performance.",
    acceptance: [
      "Code is cleaner and more maintainable",
      "Existing functionality is preserved",
      "Performance is improved or unchanged",
    ],
    order: 7,
  },
  {
    keywords: ["ui", "ux", "style", "design", "frontend"],
    title: "Update UI/Styling",
    description:
      "Update the user interface and styling to match design requirements.",
    acceptance: [
      "UI matches the design specifications",
      "Responsive layout works on target devices",
      "Visual consistency is maintained across views",
    ],
    order: 8,
  },
]

function textContainsKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw))
}

export function decomposeJobTask(
  title: string,
  body?: string,
): Array<{ title: string; description: string; acceptance: string[] }> {
  if (!title.trim()) return []

  const combined = body ? `${title} ${body}` : title

  const matched = categories
    .filter((cat) => textContainsKeywords(combined, cat.keywords))
    .sort((a, b) => a.order - b.order)
    .slice(0, 8)

  if (matched.length === 0) {
    return [
      {
        title: `Understand and implement: ${title}`,
        description: `Understand the requirements and implement "${title}" according to specifications.`,
        acceptance: [
          "Requirements are clearly understood",
          "Implementation is complete and functional",
          "Code follows project conventions",
        ],
      },
    ]
  }

  return matched.map((cat) => ({
    title: cat.title,
    description: cat.description,
    acceptance: cat.acceptance,
  }))
}
