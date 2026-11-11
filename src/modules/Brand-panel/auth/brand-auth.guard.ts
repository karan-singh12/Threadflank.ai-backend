import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
    request['brand'] = await this.brandJwt.verifyAccessToken(token);
    return true;
  }
}

/** The signed-in brand account. `brandId` always comes from here, never from the URL or body. */
export const CurrentBrand = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedBrand => {
  return ctx.switchToHttp().getRequest().brand;
});
