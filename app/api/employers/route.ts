import { NextResponse } from "next/server";
import { EMPLOYER_DIRECTORY, linkedInSearchUrl } from "@/lib/employerDirectory";
import type { EmployerProfile, EmployersResponse } from "@/lib/employers";

export const dynamic = "force-dynamic";

function employerId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `employer-${name.length}`
  );
}

// The curated Abu Dhabi employer list, grouped by sector. It is static data:
// no provider is called when this page opens.
export async function GET() {
  const employers: EmployerProfile[] = EMPLOYER_DIRECTORY.flatMap((group) =>
    group.employers.map((employer) => ({
      id: employerId(employer.name),
      name: employer.name,
      description: employer.blurb,
      logoUrl: null,
      linkedinUrl: null,
      websiteUrl: null,
      jobsSearchUrl: linkedInSearchUrl(employer.name),
      jobBoard: null,
      industries: [group.category],
      subindustries: [],
      sizeMin: null,
      sizeMax: null,
      source: "reference" as const,
    }))
  );
  const response: EmployersResponse = {
    employers,
    fetchedAt: Date.now(),
    source: "reference",
    fromCache: false,
    stale: false,
    note: "Curated Abu Dhabi employer directory.",
  };
  return NextResponse.json(response);
}
