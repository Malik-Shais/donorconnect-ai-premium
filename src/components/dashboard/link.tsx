import NextLink from "next/link";

/** Dashboard pages are per-user and rendered on the server, so a viewport prefetch costs a full server render of that page (layout, session, queries).
 *  Each list row and navigation link used to trigger one, and every action's cache refresh re-triggered all of them. Links here fetch on click instead. */
export default function Link(props: React.ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
