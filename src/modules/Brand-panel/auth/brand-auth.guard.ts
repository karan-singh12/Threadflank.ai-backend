import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedBrand, BrandJwtStrategy } from './brand-jwt.strategy';

/** Guards every /brand/* route except the public auth ones. Attaches the payload to `request.brand`. */
@Injectable()
export class BrandAuthGuard implements CanActivate {
  constructor(private readonly brandJwt: BrandJwtStrategy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const [type, token] = String(request.headers?.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Sign in to continue.');
    }
    const brand = await this.brandJwt.verifyAccessToken(token);
    // A VIEWER is read-only: any request that could change data is refused here, for every route.
    if (brand.role === 'VIEWER' && !['GET', 'HEAD', 'OPTIONS'].includes(String(request.method).toUpperCase())) {
      throw new ForbiddenException('Your role is view-only. Ask the brand owner for more access.');
    }
    request['brand'] = brand;
    return true;
  }
}

/** The signed-in brand account. `brandId` always comes from here, never from the URL or body. */
export const CurrentBrand = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedBrand => {
  return ctx.switchToHttp().getRequest().brand;
});
