import unittest
from ig_resolve import clean_handle, pick_website, build_payload


class ResolveTests(unittest.TestCase):
    def test_handles_are_normalised(self):
        self.assertEqual(clean_handle(" @IceCreamSound "), "icecreamsound")

    def test_real_website_is_passed_on(self):
        p, site, note = build_payload("acme", "Acme Sound", "acmesound.com")
        self.assertEqual(site, "https://acmesound.com")
        self.assertIsNone(note)
        self.assertEqual(p["website"], "https://acmesound.com")
        self.assertEqual(p["source"], "instaloader")

    def test_link_in_bio_pages_are_flagged_and_not_trusted(self):
        p, site, note = build_payload("acme", "Acme", "https://linktr.ee/acme")
        self.assertIn("link-in-bio", note)
        self.assertNotIn("website", p)  # Pulse will ask the operator to confirm the real site

    def test_missing_bio_link(self):
        p, site, note = build_payload("acme", None, None)
        self.assertIsNone(site)
        self.assertNotIn("website", p)
        self.assertNotIn("name", p)

    def test_pick_website_adds_scheme(self):
        self.assertEqual(pick_website("www.acme.com")[0], "https://www.acme.com")


if __name__ == "__main__":
    unittest.main()
