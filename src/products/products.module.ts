import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product, ProductImage } from './entities';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  imports: [TypeOrmModule.forFeature([Product, ProductImage]), AuthModule],
  // Al exportar el TypeOrmModule se permite utilizar los repositorios, creados en este módulo, en el módulo en el que se importen
  exports: [ProductsService, TypeOrmModule],
})
export class ProductsModule {}
