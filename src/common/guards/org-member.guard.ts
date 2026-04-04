import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class OrgMemberGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params.id || request.params.orgId;

    if (!user.organizationId || user.organizationId !== orgId) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    return true;
  }
}
