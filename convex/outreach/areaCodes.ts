/* US area code to IANA time zone, for the confirmation call's calling window.

   The booking's own time zone comes from the person who filled in the form, so
   it cannot decide when a phone rings. The number does: the window must hold in
   the zone of its area code. An area code that spans two zones lists both, and
   the window must hold in each. A code missing here (Canada, the Caribbean, a
   brand new overlay) is skipped rather than guessed. Pure data, no clock. */

const E = "America/New_York";
const C = "America/Chicago";
const M = "America/Denver";
const AZ = "America/Phoenix";
const P = "America/Los_Angeles";

const GROUPS: Array<[string[], string]> = [
  [[E], "201 202 203 207 212 215 216 220 223 227 229 231 234 239 240 248 252 260 267 269 272 276 283 301 302 304 305 313 315 317 321 324 326 329 330 332 336 339 347 351 352 363 380 386 401 404 407 410 412 413 419 423 434 436 440 443 445 463 470 472 475 478 484 502 508 513 516 517 518 540 551 561 567 570 571 582 585 586 603 606 607 609 610 614 616 617 624 631 640 645 646 656 667 678 679 680 681 686 689 703 704 706 716 717 718 724 727 728 732 734 740 743 754 757 762 765 770 771 772 774 781 786 802 803 804 810 813 814 821 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 878 904 908 910 912 914 917 919 929 934 937 941 943 947 948 954 959 973 978 980 984 989"],
  [[E, C], "270 364 448 574 812 850 906 930 931"],
  [[C], "205 210 214 217 218 219 224 225 228 235 251 254 256 262 274 281 309 312 314 316 318 319 320 325 327 331 334 337 346 353 361 402 405 409 414 417 430 447 457 464 469 479 501 504 507 512 515 531 534 539 557 563 572 573 580 601 608 612 615 618 629 630 636 641 651 659 660 662 682 708 712 713 715 726 730 731 737 763 769 773 779 806 815 816 817 830 832 847 861 870 872 901 903 913 918 920 924 936 938 940 945 952 956 972 975 979 985"],
  [[C, M], "308 432 605 620 701 785"],
  [[M], "303 307 385 406 435 505 575 719 720 801 915 970 983"],
  [[M, P], "208 458 541 986"],
  [[AZ], "480 520 602 623"],
  [[AZ, M], "928"],
  [[P], "206 209 213 253 279 310 323 341 350 360 369 408 415 424 425 442 503 509 510 530 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 949 951 971"],
  [["America/Anchorage"], "907"],
  [["Pacific/Honolulu"], "808"],
  [["America/Puerto_Rico"], "787 939"],
];

const BY_CODE = new Map<string, string[]>();
for (const [zones, codes] of GROUPS) for (const code of codes.split(" ")) BY_CODE.set(code, zones);

/** The zone(s) a +1 number's area code is in, or null when it is not a known US code. */
export function areaCodeZones(e164: string): string[] | null {
  const m = /^\+1(\d{3})\d{7}$/.exec(e164);
  return m ? (BY_CODE.get(m[1]) ?? null) : null;
}

const US_ZONES = new Set([
  ...GROUPS.flatMap(([zones]) => zones),
  "America/Detroit", "America/Boise", "America/Menominee", "America/Juneau", "America/Sitka",
  "America/Nome", "America/Yakutat", "America/Metlakatla", "America/Adak",
]);
const US_PREFIXES = ["America/Indiana/", "America/Kentucky/", "America/North_Dakota/", "US/"];

/** Is this an IANA zone inside the United States? */
export function isUsTimezone(tz: string): boolean {
  return US_ZONES.has(tz) || US_PREFIXES.some((p) => tz.startsWith(p));
}
