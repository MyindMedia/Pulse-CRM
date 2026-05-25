/* Pulse theming for ALL Clerk UI (applied on ClerkProvider, so sign-in,
   sign-up, the user button, org switcher, and any Clerk modal inherit it).
   Dark "studio" surface + Pulse gold. */
export const clerkAppearance = {
  variables: {
    colorBackground: "#141417",
    colorInputBackground: "#0d0d10",
    colorText: "#f6f6f5",
    colorTextSecondary: "#a3a3ad",
    colorInputText: "#f6f6f5",
    colorPrimary: "#fdb913",
    colorDanger: "#ff5d5d",
    colorSuccess: "#3ddc91",
    colorShimmer: "#fdb913",
    borderRadius: "10px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-inter), system-ui, sans-serif",
  },
  elements: {
    card: "bg-coal border border-hairline-2 shadow-pop",
    rootBox: "text-bone",
    headerTitle: "font-display text-bone",
    headerSubtitle: "text-ash",
    socialButtonsBlockButton: "border border-hairline-2 bg-coal/60 text-bone hover:border-gold-dim",
    socialButtonsBlockButtonText: "text-bone",
    dividerLine: "bg-hairline-2",
    dividerText: "text-ash-dim",
    formFieldLabel: "text-ash",
    formFieldInput:
      "bg-ink-2 border border-hairline-2 text-bone focus:border-gold-dim focus:ring-gold-dim/30",
    formButtonPrimary:
      "bg-gold text-gold-ink font-semibold hover:bg-gold-bright shadow-none normal-case",
    formButtonReset: "text-ash hover:text-bone",
    footerActionLink: "text-gold hover:text-gold-bright",
    footer: "bg-transparent",
    identityPreviewEditButton: "text-gold",
    badge: "bg-gold/10 text-gold",
    // User button + org switcher popovers
    userButtonPopoverCard: "bg-coal border border-hairline-2 shadow-pop",
    userButtonPopoverActionButton: "text-ash hover:text-bone hover:bg-ink-2",
    userButtonPopoverFooter: "hidden",
    organizationSwitcherPopoverCard: "bg-coal border border-hairline-2 shadow-pop",
    organizationSwitcherTrigger: "text-bone hover:bg-ink-2",
    organizationPreviewMainIdentifier: "text-bone",
    // Modal chrome
    modalContent: "bg-coal",
    modalCloseButton: "text-ash hover:text-bone",
  },
} as const;
