/* Pulse theming for ALL Clerk UI (applied on ClerkProvider, so sign-in,
   sign-up, the user button, org switcher, and any Clerk modal inherit it).
   Liquid-glass studio surface + Pulse gold - matched to the 2026-07 app-wide
   glass overhaul (material-* slabs, .glass-edge razor hairline, motion
   tokens, 14.4px chrome radius). */
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
    borderRadius: "14.4px" /* --radius-chrome, the app-wide radius */,
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-inter), system-ui, sans-serif",
  },
  elements: {
    /* One liquid-glass slab: the OUTER box carries the material + razor
       hairline; the inner card and footer go transparent so main area +
       footer read as a single glass surface (same recipe as the app's
       Card/Dialog). */
    cardBox: "material-thick glass-edge border-transparent shadow-pop",
    /* The trailing ! (Tailwind v4 important) is required: Clerk's own
       stylesheet loads after ours and otherwise wins on these props. */
    card: "bg-transparent! shadow-none",
    rootBox: "text-bone",
    // We render the Pulse logo above the card ourselves - hide Clerk's logo box.
    logoBox: "hidden",
    headerTitle: "font-display text-bone tracking-tight",
    headerSubtitle: "text-ash",
    socialButtonsBlockButton:
      "border border-hairline-2 bg-ink-2/60 text-bone transition-colors hover:border-gold-dim hover:bg-coal-2/70",
    socialButtonsBlockButtonText: "text-bone",
    dividerLine: "bg-hairline-2",
    dividerText: "text-ash-dim",
    formFieldLabel: "text-ash",
    formFieldInput:
      "bg-ink-2 border border-hairline-2 text-bone transition-colors focus:border-gold-dim focus:ring-gold-dim/30",
    formFieldInputShowPasswordButton: "text-ash-dim hover:text-bone",
    otpCodeFieldInput: "bg-ink-2 border border-hairline-2 text-bone focus:border-gold-dim",
    /* Gold primary with the app button voice: specular sweep + press scale. */
    formButtonPrimary:
      "sheen press bg-gold text-gold-ink font-semibold transition-colors hover:bg-gold-bright shadow-none normal-case",
    formButtonReset: "text-ash hover:text-bone",
    formResendCodeLink: "text-gold hover:text-gold-bright",
    footerActionText: "text-ash",
    footerActionLink: "text-gold hover:text-gold-bright",
    /* Clerk paints the footer with a background-image gradient; bg-none!
       clears it so the footer rows sit on the same glass slab as the card. */
    footer: "bg-transparent! bg-none!",
    footerAction: "bg-transparent! bg-none!",
    identityPreviewText: "text-bone",
    identityPreviewEditButton: "text-gold",
    formFieldErrorText: "text-critical",
    alertText: "text-ash",
    badge: "bg-gold/10 text-gold",
    /* "Secured by Clerk" is controlled INSTANCE-side: on the Pro plan flip
       "Remove Clerk branding" in Dashboard -> Customization. Dev instances
       (pk_test) force the badge + development-mode banner regardless; both
       clear on the production instance (see GO-LIVE blocker in Grilled.md). */
    // User button + org switcher popovers - floating glass, like app menus.
    userButtonPopoverCard: "material-regular glass-edge border-transparent shadow-pop",
    userButtonPopoverActionButton: "text-ash transition-colors hover:text-bone hover:bg-ink-2/70",
    userButtonPopoverFooter: "hidden",
    organizationSwitcherPopoverCard: "material-regular glass-edge border-transparent shadow-pop",
    organizationSwitcherTrigger: "text-bone hover:bg-ink-2/70",
    organizationPreviewMainIdentifier: "text-bone",
    // Modal chrome - highest floating layer gets the deepest material.
    modalContent: "material-thick glass-edge border-transparent",
    modalBackdrop: "bg-ink/70 backdrop-blur-md",
    modalCloseButton: "text-ash hover:text-bone",
  },
} as const;
