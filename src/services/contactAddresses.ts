import * as Contacts from "expo-contacts";

// Real, explicit request (Waze-style redesign Phase 4 -- "Drive to friends & family via
// Contacts", the "More options" row WhereToSheet.tsx previously had to honestly defer since no
// expo-contacts dependency existed yet). Reads the device's own real contacts via expo-contacts
// -- never writes/modifies anything -- and only ever surfaces contacts that actually have a
// street address saved (a contact with no address has nothing a driving app could route to).

export interface ContactWithAddress {
  id: string;
  name: string;
  // Single real address per contact -- the first one on file. A contact with several saved
  // addresses (home/work) only ever shows the first; picking a specific one isn't built, same
  // real "first pass, not every edge case" scope as every other new Phase 4 piece this session.
  addressLabel: string;
  formattedAddress: string;
}

function formatAddress(a: Contacts.Address): string {
  return [a.street, a.city, a.region, a.postalCode].filter(Boolean).join(", ");
}

export async function requestContactsAccess(): Promise<boolean> {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === "granted";
}

export async function getContactsPermissionStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const { status } = await Contacts.getPermissionsAsync();
  return status as "granted" | "denied" | "undetermined";
}

export async function getContactsWithAddresses(): Promise<ContactWithAddress[]> {
  const { status } = await Contacts.getPermissionsAsync();
  if (status !== "granted") return [];

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Addresses],
    sort: Contacts.SortTypes.FirstName,
  });

  const withAddresses: ContactWithAddress[] = [];
  for (const contact of data) {
    const address = contact.addresses?.[0];
    if (!address) continue;
    const formattedAddress = formatAddress(address);
    if (!formattedAddress) continue;
    withAddresses.push({
      id: contact.id ?? contact.name,
      name: contact.name,
      addressLabel: address.label,
      formattedAddress,
    });
  }
  return withAddresses;
}
