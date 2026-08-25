import { describe, expect, it } from "vitest";
import { parseCaseUpdate, parseOrganizationUpdate, parsePersonUpdate } from "@/modules/cases/update";

describe("legal context updates", () => {
  it("accepts editable case fields and rejects an empty matter name", () => {
    expect(
      parseCaseUpdate({
        matterName: "  Lee v. Metro Transit  ",
        status: "on_hold",
        assignedUserId: "user-1",
      }),
    ).toEqual({
      ok: true,
      value: {
        matterName: "Lee v. Metro Transit",
        status: "on_hold",
        assignedUserId: "user-1",
      },
    });

    expect(parseCaseUpdate({ matterName: " ", status: "active", assignedUserId: "user-1" })).toEqual({
      ok: false,
      errors: { matterName: "Matter name is required." },
    });
  });

  it("normalizes person contact details and treats a blank timezone as inferred", () => {
    expect(
      parsePersonUpdate({
        name: "Jordan Lee",
        phone: "312-555-0101",
        email: "jordan@example.com",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Jordan Lee",
        phone: "+13125550101",
        email: "jordan@example.com",
        timeZone: "America/Chicago",
        timeZoneSource: "explicit",
      },
    });

    expect(
      parsePersonUpdate({
        name: "Elena Park",
        phone: "",
        email: "",
        timeZone: "",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Elena Park",
        phone: null,
        email: null,
        timeZone: null,
        timeZoneSource: null,
      },
    });
  });

  it("rejects invalid person email and timezone without changing the rest of the payload", () => {
    expect(
      parsePersonUpdate({
        name: "Sam Rivera",
        phone: "",
        email: "not-an-email",
        timeZone: "Chicago",
      }),
    ).toEqual({
      ok: false,
      errors: {
        email: "Enter a valid email, or leave it blank.",
        timeZone: "Choose a valid IANA timezone.",
      },
    });
  });

  it("accepts organization contact fields used on a case", () => {
    expect(
      parseOrganizationUpdate({
        name: " Northside Imaging ",
        type: "medical_provider",
        phone: "312-555-0199",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Northside Imaging",
        type: "medical_provider",
        phone: "+13125550199",
      },
    });
  });
});
