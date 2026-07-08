import { describe, it, expect } from "vitest";
import { classifyClerkCreateUserError } from "./clerkErrors";

const body = (errors: unknown[]) => JSON.stringify({ errors });

describe("classifyClerkCreateUserError", () => {
  it("email collision -> email_exists", () => {
    const r = classifyClerkCreateUserError(
      body([{ code: "form_identifier_exists", message: "That email address is taken. Please try another.", meta: { param_name: "email_address" } }]),
    );
    expect(r.kind).toBe("email_exists");
  });

  it("phone collision (meta.param_name) -> phone_exists", () => {
    const r = classifyClerkCreateUserError(
      body([{ code: "form_identifier_exists", long_message: "That phone number is taken. Please try another.", meta: { param_name: "phone_number" } }]),
    );
    expect(r.kind).toBe("phone_exists");
    expect(r.message).toMatch(/phone/i);
  });

  it("phone collision without meta falls back to message sniffing", () => {
    const r = classifyClerkCreateUserError(
      body([{ code: "form_identifier_exists", message: "That phone number is taken." }]),
    );
    expect(r.kind).toBe("phone_exists");
  });

  it("identifier collision with no hints defaults to email_exists (old behavior)", () => {
    const r = classifyClerkCreateUserError(body([{ code: "form_identifier_exists", message: "Identifier already exists." }]));
    expect(r.kind).toBe("email_exists");
  });

  it("non-collision errors -> other, with Clerk's actionable message", () => {
    const r = classifyClerkCreateUserError(
      body([{ code: "form_password_pwned", long_message: "Password has been found in an online data breach." }]),
    );
    expect(r).toEqual({ kind: "other", message: "Password has been found in an online data breach." });
  });

  it("garbage bodies -> other, generic message", () => {
    expect(classifyClerkCreateUserError("<html>bad gateway</html>")).toEqual({
      kind: "other",
      message: "Account creation failed.",
    });
  });
});
