/**
 * Dedicated address book management page.
 */

import { BackToHome } from '@/components/common/BackToHome'
import { AddressBookManager } from '@/components/addressBook/AddressBookManager'

export function AddressBook() {
  return (
    <div className="container mx-auto p-12">
      <div className="mb-12 flex items-center justify-between gap-3 px-48">
        <BackToHome />
      </div>

      <div className="px-48 mx-auto">
        <AddressBookManager />
        <div className="min-h-12" />
      </div>
    </div>
  )
}

