import { Link } from 'react-router-dom'
import { ArrowBigLeft } from 'lucide-react'
import { Button } from './Button'

export function BackToHome() {
  return (
    <Link to="/dashboard">
      <Button variant="ghost" className="mb-2 gap-2">
        <ArrowBigLeft className="h-4 w-4" />
        Home
      </Button>
    </Link>
  )
}

